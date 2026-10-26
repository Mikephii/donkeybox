// The DonkeyBox mark, as in the box (packages/app/web/src/components/signature/mark.tsx): a box with
// two ears and a prompt cut out of it, in currentColor. The mask id is per instance.
import { useId, type SVGProps } from 'react';

export function Mark({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  const id = `dbx-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 200 200" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
          <rect width="200" height="200" fill="#fff" />
          <g fill="none" stroke="#000" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round">
            <path d="M62 146 H92" />
            <path d="M137 114 L110 130 L137 146" />
          </g>
        </mask>
      </defs>
      {/* The box and its ears as one shape, so a translucent mark (the ghost) has no darker overlaps. */}
      <path mask={`url(#${id})`} fill="currentColor" fillRule="evenodd" d="M25 100A22 22 0 0 1 47 78H49.18L67.536 44.964A6.25 6.25 0 0 1 78.464 44.964L96.817 78H103.18L121.536 44.964A6.25 6.25 0 0 1 132.464 44.964L150.817 78H153A22 22 0 0 1 175 100V168A22 22 0 0 1 153 190H47A22 22 0 0 1 25 168ZM63.484 78H82.516L73 60.87ZM117.484 78H136.516L127 60.87Z" />
    </svg>
  );
}
