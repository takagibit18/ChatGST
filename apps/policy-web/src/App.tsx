import { ArrowUp, Books, ChatCircleDots, CircleNotch, Plus, WarningCircle } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { PolicyAnswer } from "@/components/PolicyAnswer";
import { KnowledgeBrowser } from "@/components/KnowledgeBrowser";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePolicySocket, type ConnectionState } from "@/hooks/use-policy-socket";

const starterQuestions = [
  "北京育儿补贴每年多少钱？",
  "河北育儿补贴申请资格是什么？",
  "北京和河北政策有什么区别？",
  "育儿补贴和生育津贴是一回事吗？",
];

const connectionLabels: Record<ConnectionState, string> = {
  connecting: "正在连接",
  online: "服务已连接",
  offline: "正在重连",
};

export default function App() {
  const { ask, busy, connection, error, messages, reset, status } = usePolicySocket();
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"chat" | "knowledge">("chat");
  const userTurnCount = messages.filter((message) => message.from === "user").length;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (ask(draft)) setDraft("");
  };

  const askSuggestion = (value: string) => {
    if (ask(value)) setDraft("");
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground">
              <ChatCircleDots aria-hidden size={22} weight="fill" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">北京 + 河北育儿补贴政策助手</h1>
              <p className="text-xs text-muted-foreground">本地知识库 · 技术验证版</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden rounded-[10px] border bg-surface-strong p-0.5 sm:flex">
              <Button onClick={() => setView("chat")} size="sm" type="button" variant={view === "chat" ? "secondary" : "ghost"}><ChatCircleDots aria-hidden size={15} />对话</Button>
              <Button onClick={() => setView("knowledge")} size="sm" type="button" variant={view === "knowledge" ? "secondary" : "ghost"}><Books aria-hidden size={15} />知识库</Button>
            </div>
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <span
                aria-hidden
                className={`size-2 rounded-full ${connection === "online" ? "bg-primary" : "bg-muted-foreground"}`}
              />
              {connectionLabels[connection]}
            </span>
            <Button className={view === "knowledge" ? "hidden sm:inline-flex" : undefined} disabled={busy} onClick={reset} size="sm" type="button" variant="outline">
              <Plus aria-hidden size={15} weight="bold" />
              新建会话
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-0 sm:px-6 sm:py-5">
        <div className="flex border-b bg-surface-strong p-2 sm:hidden">
          <Button className="flex-1" onClick={() => setView("chat")} size="sm" type="button" variant={view === "chat" ? "secondary" : "ghost"}>对话</Button>
          <Button className="flex-1" onClick={() => setView("knowledge")} size="sm" type="button" variant={view === "knowledge" ? "secondary" : "ghost"}>知识库</Button>
        </div>
        {view === "knowledge" ? <KnowledgeBrowser /> : <section className="flex min-h-[calc(100dvh-4rem)] flex-1 flex-col overflow-hidden bg-surface sm:min-h-0 sm:rounded-2xl sm:border sm:shadow-[0_16px_50px_rgba(24,60,47,0.08)]">
          <Conversation>
            <ConversationContent>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  description="查询北京市、河北省育儿补贴的金额、资格、材料、渠道、时限，也可以比较两地政策。回答仅引用本轮检索到的来源。"
                  icon={<ChatCircleDots aria-hidden size={26} weight="duotone" />}
                  title="先从一个具体问题开始"
                >
                  <Suggestions className="max-w-2xl">
                    {starterQuestions.map((question) => (
                      <Suggestion key={question} onSelect={askSuggestion} value={question}>
                        {question}
                      </Suggestion>
                    ))}
                  </Suggestions>
                </ConversationEmptyState>
              ) : (
                messages.map((message) => (
                  <Message from={message.from} key={message.id}>
                    {message.from === "user" ? (
                      <MessageContent>{message.text}</MessageContent>
                    ) : (
                      <PolicyAnswer
                        actionsEnabled={userTurnCount < 2 && !busy}
                        onAction={askSuggestion}
                        response={message.response}
                      />
                    )}
                  </Message>
                ))
              )}

              {busy && status ? (
                <div aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <CircleNotch aria-hidden className="animate-spin text-primary" size={18} weight="bold" />
                  <span>{status}</span>
                </div>
              ) : null}

              {error ? (
                <div aria-live="assertive" className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
                  <WarningCircle aria-hidden className="mt-0.5 shrink-0" size={18} weight="fill" />
                  <span>{error}</span>
                </div>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="border-t bg-surface-strong p-4 sm:p-5">
            <form className="mx-auto w-full max-w-3xl" onSubmit={submit}>
              <label className="sr-only" htmlFor="policy-question">
                输入政策问题
              </label>
              <div className="flex items-end gap-2 rounded-xl border bg-surface px-3 py-2 focus-within:ring-3 focus-within:ring-ring/20">
                <Textarea
                  autoComplete="off"
                  className="max-h-32 min-h-12 resize-none border-0 bg-transparent px-1 py-3 shadow-none focus-visible:ring-0"
                  disabled={busy}
                  id="policy-question"
                  maxLength={2000}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="例如：北京育儿补贴需要哪些材料？"
                  rows={1}
                  value={draft}
                />
                <Button
                  aria-label="提交问题"
                  disabled={busy || connection !== "online" || draft.trim().length === 0}
                  size="icon"
                  type="submit"
                >
                  {busy ? <CircleNotch aria-hidden className="animate-spin" size={18} /> : <ArrowUp aria-hidden size={18} weight="bold" />}
                </Button>
              </div>
            </form>
            <div className="mx-auto mt-3 w-full max-w-3xl">
              <PrivacyNotice />
            </div>
          </div>
        </section>}
      </main>
    </div>
  );
}
