import { Liquid } from "./liquid-control";

export function BrandMark() {
  return (
    <Liquid as="button" shape="pill" className="brand-mark" type="button" aria-label="Kosmos">
      <img className="brand-mark-logo" src="/brand/logo.png" alt="" width={400} height={289} />
      <span className="brand-mark-name">kosmos</span>
    </Liquid>
  );
}
