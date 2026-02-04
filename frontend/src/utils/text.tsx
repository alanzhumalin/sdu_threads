import { Fragment } from "react";
import { Link } from "react-router-dom";
import { MentionPreview } from "../components/MentionPreview";

const punctOrSpace = /[\s.,!?;:()[\]{}"']/;
const emailLike = /@[^@\s]+\.[A-Za-z]{2,}$/;

export const highlightHashtags = (
  text: string,
  allowedMentions?: Set<string>,
  allowedHashtags?: Set<string>,
  renderers?: {
    mention?: (username: string, node: JSX.Element) => JSX.Element;
  }
) => {
  const out: JSX.Element[] = [];
  const regex = /[#@][\p{L}\p{N}._-]*/gu;
  let last = 0;
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > last) {
      out.push(<Fragment key={last}>{text.slice(last, start)}</Fragment>);
    }
    const token = match[0];
    const prev = start === 0 ? "" : text[start - 1];
    const isBoundary = start === 0 || punctOrSpace.test(prev);
    const looksLikeEmail = emailLike.test(token);
    if (token.startsWith("#") && allowedHashtags?.has(token.slice(1).toLowerCase())) {
      out.push(
        <span key={`${start}-#`} className="text-sky-400 font-semibold">
          {token}
        </span>
      );
    } else if (
      token.startsWith("@") &&
      !looksLikeEmail &&
      (isBoundary || !punctOrSpace.test(prev)) &&
      allowedMentions?.has(token.slice(1).toLowerCase())
    ) {
      const username = token.slice(1);
      const baseNode = (
        <Link
          to={`/u/${username}`}
          className="text-purple-400 font-semibold hover:underline"
        >
          {token}
        </Link>
      );
      const rendered = renderers?.mention ? renderers.mention(username, baseNode) : (
        <MentionPreview username={username}>{baseNode}</MentionPreview>
      );
      out.push(<Fragment key={`${start}-@`}>{rendered}</Fragment>);
    } else {
      out.push(<Fragment key={`${start}-t`}>{token}</Fragment>);
    }
    last = end;
  }
  if (last < text.length) {
    out.push(<Fragment key={last}>{text.slice(last)}</Fragment>);
  }
  if (out.length === 0) return [<Fragment key="empty">{text}</Fragment>];
  return out;
};
