import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/PageHeader";
// The same file the docs site publishes (docs/product/guide.md); its frontmatter carries the title.
import guideSource from "../../../../../docs/product/guide.md?raw";

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n+/;
const guideTitle = guideSource.match(FRONTMATTER)?.[1].match(/^title:\s*"?(.*?)"?$/m)?.[1] ?? "Guide";
const guide = `# ${guideTitle}\n\n${guideSource.replace(FRONTMATTER, "")}`;

export function GuidePage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Guide" description="How the box works, how to set it up, and a worked Jira example." subject="page:/guide" />
      <ScrollArea className="min-h-0 flex-1">
        <article className="wb-md wb-guide mx-auto max-w-3xl p-8 text-sm leading-relaxed" data-testid="guide">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) =>
                href?.startsWith("/") ? <Link to={href}>{children}</Link> : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
            }}
          >
            {guide}
          </ReactMarkdown>
        </article>
      </ScrollArea>
    </div>
  );
}
