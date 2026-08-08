/**
 * The DOJRP shield emblem (public/dojrp-shield.png), sized via className.
 * Pairs with <DojrpLogo /> for consistent branding across portal pages.
 */
const DojrpShield = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <img
    src={`${import.meta.env.BASE_URL}dojrp-shield.png`}
    alt=""
    aria-hidden="true"
    className={className}
  />
);

export default DojrpShield;
