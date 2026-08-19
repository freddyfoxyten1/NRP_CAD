/**
 * Northpoint Roleplay badge (public/nrp-logo.png), sized via className.
 * Pairs with <DojrpLogo /> for consistent branding across portal pages.
 */
const DojrpShield = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <img
    src={`${import.meta.env.BASE_URL}nrp-logo.png`}
    alt="Northpoint Roleplay"
    className={`object-contain ${className}`}
  />
);

export default DojrpShield;
