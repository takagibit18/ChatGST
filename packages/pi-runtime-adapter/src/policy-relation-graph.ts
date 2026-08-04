export type PolicyRelationType =
  | "same_document"
  | "same_version_group"
  | "same_policy_number"
  | "implements"
  | "parent_policy"
  | "supersedes";

export type PolicyRelationEdge = {
  from_document_id: string;
  to_document_id: string;
  relation: PolicyRelationType;
};

export type PolicyRelationBinding = {
  document_id: string;
  version_group?: string | null;
  policy_number?: string | null;
  implementation_of?: string | null;
  parent_policy_id?: string | null;
  supersedes?: string | null;
};

export type PolicyGraphIncompatibility =
  | "cross_claim_version_conflict"
  | "unknown_policy_compatibility"
  | "disconnected_policy_bundle"
  | "mixed_policy_lineage";

export type PolicyGraphAssessment = {
  compatible: boolean;
  edges: PolicyRelationEdge[];
  incompatibility_reasons: PolicyGraphIncompatibility[];
};

function known(value: string | null | undefined): value is string {
  return Boolean(value && value !== "unknown");
}

function edgeKey(edge: PolicyRelationEdge): string {
  return `${edge.from_document_id}\u0000${edge.to_document_id}\u0000${edge.relation}`;
}

function addEdge(edges: PolicyRelationEdge[], seen: Set<string>, edge: PolicyRelationEdge): void {
  const key = edgeKey(edge);
  if (seen.has(key)) return;
  seen.add(key);
  edges.push(edge);
}

export function assessPolicyRelationGraph(
  bindings: PolicyRelationBinding[],
  options: { allowHistoricalLineage?: boolean } = {},
): PolicyGraphAssessment {
  const documents = new Map<string, PolicyRelationBinding>();
  for (const binding of bindings) {
    const existing = documents.get(binding.document_id);
    if (!existing) {
      documents.set(binding.document_id, binding);
      continue;
    }
    const merged = { ...existing };
    if (merged.version_group == null && binding.version_group !== undefined) merged.version_group = binding.version_group;
    if (merged.policy_number == null && binding.policy_number !== undefined) merged.policy_number = binding.policy_number;
    if (merged.implementation_of == null && binding.implementation_of !== undefined) merged.implementation_of = binding.implementation_of;
    if (merged.parent_policy_id == null && binding.parent_policy_id !== undefined) merged.parent_policy_id = binding.parent_policy_id;
    if (merged.supersedes == null && binding.supersedes !== undefined) merged.supersedes = binding.supersedes;
    documents.set(binding.document_id, merged);
  }
  const nodes = [...documents.values()];
  if (nodes.length <= 1) return { compatible: true, edges: [], incompatibility_reasons: [] };

  const edges: PolicyRelationEdge[] = [];
  const seen = new Set<string>();
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex]!;
      if (left.document_id === right.document_id) {
        addEdge(edges, seen, { from_document_id: left.document_id, to_document_id: right.document_id, relation: "same_document" });
      }
      if (known(left.version_group) && left.version_group === right.version_group) {
        addEdge(edges, seen, { from_document_id: left.document_id, to_document_id: right.document_id, relation: "same_version_group" });
      }
      if (known(left.policy_number) && left.policy_number === right.policy_number) {
        addEdge(edges, seen, { from_document_id: left.document_id, to_document_id: right.document_id, relation: "same_policy_number" });
      }
    }
  }

  const identityOwners = new Map<string, string[]>();
  for (const node of nodes) {
    for (const identity of [node.document_id, node.policy_number].filter(known)) {
      identityOwners.set(identity, [...(identityOwners.get(identity) ?? []), node.document_id]);
    }
  }
  for (const node of nodes) {
    for (const [relation, target] of [
      ["implements", node.implementation_of],
      ["parent_policy", node.parent_policy_id],
      ["supersedes", node.supersedes],
    ] as const) {
      if (!known(target)) continue;
      for (const targetDocumentId of identityOwners.get(target) ?? []) {
        if (targetDocumentId === node.document_id) continue;
        addEdge(edges, seen, { from_document_id: node.document_id, to_document_id: targetDocumentId, relation });
      }
    }
  }

  const supersedesEdges = edges.filter((edge) => edge.relation === "supersedes");
  const allowedEdges = edges.filter((edge) => edge.relation !== "supersedes" || options.allowHistoricalLineage);
  const adjacency = new Map(nodes.map((node) => [node.document_id, new Set<string>()]));
  for (const edge of allowedEdges) {
    adjacency.get(edge.from_document_id)?.add(edge.to_document_id);
    adjacency.get(edge.to_document_id)?.add(edge.from_document_id);
  }
  const visited = new Set<string>();
  const queue = [nodes[0]!.document_id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) if (!visited.has(neighbor)) queue.push(neighbor);
  }

  const disconnected = visited.size !== nodes.length;
  const mixedLineage = supersedesEdges.length > 0 && !options.allowHistoricalLineage;
  const metadataKnown = nodes.every((node) => known(node.version_group) || known(node.policy_number)
    || known(node.implementation_of) || known(node.parent_policy_id) || known(node.supersedes));
  const reasons: PolicyGraphIncompatibility[] = [];
  if (mixedLineage) reasons.push("mixed_policy_lineage");
  if (disconnected) {
    reasons.push("disconnected_policy_bundle");
    reasons.push(metadataKnown ? "cross_claim_version_conflict" : "unknown_policy_compatibility");
  }
  return { compatible: reasons.length === 0, edges, incompatibility_reasons: [...new Set(reasons)] };
}
