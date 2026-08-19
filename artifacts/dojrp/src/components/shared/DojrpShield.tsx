/** Bumped when public/nrp-logo.png changes so browsers fetch the latest asset. */
export const NRP_LOGO_URL = `${import.meta.env.BASE_URL}nrp-logo.png?v=2`;

/**
 * Northpoint Roleplay badge (public/nrp-logo.png), sized via className.
 * Pairs with <DojrpLogo /> for consistent branding across portal pages.
 */
const DojrpShield = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <img
    src={NRP_LOGO_URL}
    alt="Northpoint Roleplay"
    className={`object-contain ${className}`}
  />
);

export default DojrpShield;
