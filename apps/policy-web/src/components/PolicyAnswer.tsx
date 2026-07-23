import { CaretDown } from "@phosphor-icons/react";
import type { PolicyResponse } from "@policy/schemas/index";
import { MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { SourceLink, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type PolicyAnswerProps = { response: PolicyResponse; onAction: (value: string) => void; actionsEnabled?: boolean };

export function PolicyAnswer({ response, onAction, actionsEnabled = true }: PolicyAnswerProps) {
  const details = response.collapsibles.filter((item) => item.title !== "数据来源");
  return (
    <MessageContent className="w-full">
      <MessageResponse>{response.answer_markdown}</MessageResponse>
      {details.map((item) => (
        <Collapsible className="mt-3 border-t pt-3" key={item.title}>
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 py-1 text-left text-sm font-semibold">
            <span>{item.title}</span>
            <CaretDown aria-hidden size={16} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 text-sm text-muted-foreground">
            <MessageResponse>{item.content_markdown}</MessageResponse>
          </CollapsibleContent>
        </Collapsible>
      ))}
      {response.sources.length > 0 ? (
        <Sources>
          <SourcesTrigger count={response.sources.length} />
          <SourcesContent>
            {response.sources.map((source) => (
              <SourceLink href={source.url} key={source.document_id}>
                <span>{source.title}</span>
              </SourceLink>
            ))}
          </SourcesContent>
        </Sources>
      ) : null}
      {actionsEnabled && response.actions.length > 0 ? (
        <Suggestions className="mt-4">
          {response.actions.map((action) => (
            <Suggestion key={action.id} onSelect={onAction} value={action.value}>
              {action.label}
            </Suggestion>
          ))}
        </Suggestions>
      ) : null}
    </MessageContent>
  );
}
