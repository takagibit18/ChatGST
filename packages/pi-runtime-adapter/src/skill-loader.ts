import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export type LoadedProfile = {
  id: string;
  systemPrompt: string;
  skillText: string;
};

export class SkillLoader {
  constructor(private readonly root = resolve("domains")) {}

  async load(domainId: string): Promise<LoadedProfile> {
    if (!/^[a-z0-9-]+$/u.test(domainId)) throw new Error("Invalid domain id");
    const domainRoot = resolve(this.root, domainId);
    if (!domainRoot.startsWith(`${resolve(this.root)}\\`) && !domainRoot.startsWith(`${resolve(this.root)}/`)) {
      throw new Error("Domain escapes configured root");
    }
    const profile = await readFile(resolve(domainRoot, "profile/profile.md"), "utf8");
    const skillDir = resolve(domainRoot, "skills");
    const skillFiles = (await readdir(skillDir)).filter((file) => file.endsWith(".md")).sort();
    const skills = await Promise.all(skillFiles.map((file) => readFile(resolve(skillDir, file), "utf8")));
    return { id: domainId, systemPrompt: profile.trim(), skillText: skills.join("\n\n").trim() };
  }
}

