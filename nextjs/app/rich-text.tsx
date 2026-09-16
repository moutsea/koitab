import { Fragment } from "react";

/**
 * 极轻量的行内标记渲染:支持 **加粗** 与 `等宽`。
 * 用它代替 dangerouslySetInnerHTML —— 文案是纯字符串(单一来源),
 * 需要强调的地方直接写标记,既不引入 XSS 面,也让内容能被 JSON-LD 复用。
 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <b key={i}>{part.slice(2, -2)}</b>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
