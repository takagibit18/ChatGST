import { ShieldCheck } from "@phosphor-icons/react";

export function PrivacyNotice() {
  return (
    <aside className="flex items-start gap-2 text-xs leading-5 text-muted-foreground" aria-label="使用和隐私提示">
      <ShieldCheck aria-hidden className="mt-0.5 shrink-0 text-primary" size={17} weight="bold" />
      <p>
        本工具仅用于政策信息查询和技术验证，结果以当地主管部门最终审核为准。请勿输入身份证号、手机号、银行卡号等敏感个人信息。
      </p>
    </aside>
  );
}

