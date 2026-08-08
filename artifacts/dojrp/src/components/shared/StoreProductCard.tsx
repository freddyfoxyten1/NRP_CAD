import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { StoreDescriptionHtml } from "@/components/shared/StoreDescriptionEditor";

export type StorePriceIcon = "robux" | "dollar" | "custom";

export type StoreProduct = {
  id?: number;
  badge_label: string;
  heading: string;
  description: string;
  price: string;
  price_label: string;
  price_icon: StorePriceIcon;
  price_icon_url: string;
  footer_text: string;
  button_text: string;
  button_url: string;
  image_url: string;
};

function RobuxIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12.5 2.1 20.4 6.7v9.2L12.5 20.5 4.6 15.9V6.7L12.5 2.1Zm0 2.3L6.8 7.7v7.2l5.7 3.3 5.7-3.3V7.7L12.5 4.4Zm0 2.8 3.4 2v3.9l-3.4 2-3.4-2V9.2l3.4-2Z" />
    </svg>
  );
}

function PriceIcon({
  icon,
  iconUrl,
  className = "h-5 w-5",
}: {
  icon: StorePriceIcon;
  iconUrl?: string;
  className?: string;
}) {
  if (icon === "custom" && iconUrl?.trim()) {
    return (
      <img
        src={iconUrl.trim()}
        alt=""
        className={`${className} object-contain`}
      />
    );
  }
  if (icon === "dollar") {
    return (
      <span
        className={`inline-flex items-center justify-center font-black leading-none text-white ${className}`}
        style={{ fontSize: "1.15em" }}
        aria-hidden
      >
        $
      </span>
    );
  }
  return <RobuxIcon className={className} />;
}

function normalizePriceIcon(value: unknown): StorePriceIcon {
  if (value === "dollar" || value === "custom" || value === "robux") return value;
  return "robux";
}

/** Product card matching the Server Store pack design. */
export default function StoreProductCard({
  product,
  fallbackBuyUrl = "",
  /** On the public index, collapse long description text behind Show / Hide. */
  collapsibleDescription = false,
}: {
  product: StoreProduct;
  fallbackBuyUrl?: string;
  collapsibleDescription?: boolean;
}) {
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  const buyUrl = (product.button_url || fallbackBuyUrl || "").trim();
  const buttonLabel = (product.button_text ?? "").trim();
  const badge = (product.badge_label ?? "").trim();
  const heading = (product.heading ?? "").trim();
  const description = (product.description ?? "").trim();
  const price = (product.price ?? "").trim();
  const priceLabel = (product.price_label ?? "").trim();
  const footer = (product.footer_text ?? "").trim();
  const imageUrl = (product.image_url ?? "").trim();
  const priceIcon = normalizePriceIcon(product.price_icon);
  const priceIconUrl = (product.price_icon_url ?? "").trim();

  const hasPrice = !!(price || priceLabel);
  const hasFooter = !!(footer || buttonLabel);
  const showFullDescription = !collapsibleDescription || descriptionOpen;

  const buyButtonClass =
    "inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#2f66ee] px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#3977ff]";

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-[#131f30] bg-[#070d16] shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
      {imageUrl ? (
        <div className="relative flex h-44 shrink-0 items-center justify-center bg-[radial-gradient(ellipse_at_70%_20%,rgba(67,132,255,0.18),transparent_55%),linear-gradient(180deg,#0d1524_0%,#070d16_100%)]">
          <img
            src={imageUrl}
            alt=""
            className="max-h-28 max-w-[70%] object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.45)]"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2 px-5 pb-5 pt-4">
        {badge ? (
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#4384ff]">
            {badge}
          </p>
        ) : null}

        {heading ? (
          <h3 className="text-xl font-black leading-tight tracking-tight text-white">
            {heading}
          </h3>
        ) : null}

        {description ? (
          <div className="space-y-2">
            {showFullDescription ? (
              <StoreDescriptionHtml value={description} className="text-[#8392aa]" />
            ) : (
              <div className="relative max-h-[3.6em] overflow-hidden">
                <StoreDescriptionHtml
                  value={description}
                  className="pointer-events-none select-none text-[#8392aa] opacity-70"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#070d16] to-transparent" />
              </div>
            )}
            {collapsibleDescription ? (
              <button
                type="button"
                onClick={() => setDescriptionOpen(open => !open)}
                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#4384ff] transition-colors hover:text-[#6fa3ff]"
              >
                {descriptionOpen ? (
                  <>
                    Hide
                    <ChevronUp className="h-3 w-3" />
                  </>
                ) : (
                  <>
                    Show
                    <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
            ) : null}
          </div>
        ) : null}

        {hasPrice ? (
          <div className="flex items-end gap-2 pt-1">
            <PriceIcon
              icon={priceIcon}
              iconUrl={priceIconUrl}
              className="mb-0.5 h-5 w-5 shrink-0 text-[#a8b7cd]"
            />
            {price ? (
              <span className="text-3xl font-black leading-none text-[#4384ff]">
                {price}
              </span>
            ) : null}
            {priceLabel ? (
              <span className="mb-0.5 text-sm font-semibold text-[#526179]">
                {priceLabel}
              </span>
            ) : null}
          </div>
        ) : null}

        {hasFooter ? (
          <>
            <div className="mt-1 h-px w-full shrink-0 bg-[#131f30]" />
            <div className="flex items-center justify-between gap-3 pt-1">
              {footer ? (
                <p className="text-xs font-semibold text-[#3f5470]">{footer}</p>
              ) : (
                <span />
              )}
              {buttonLabel ? (
                buyUrl ? (
                  <a
                    href={buyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buyButtonClass}
                  >
                    {buttonLabel}
                  </a>
                ) : (
                  <span className={`${buyButtonClass} cursor-default opacity-40`}>
                    {buttonLabel}
                  </span>
                )
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}
