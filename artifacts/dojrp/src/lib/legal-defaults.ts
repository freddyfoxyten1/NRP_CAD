import type { ContentBlock } from '@/components/shared/ContentBlocks';

/** Built-in Terms of Service shown until an admin publishes a custom version. */
export const DEFAULT_TERMS_SECTIONS: ContentBlock[] = [
  {
    type: 'text',
    body: 'Last updated: August 2026',
  },
  { type: 'heading', text: '1. What Northpoint CAD is' },
  {
    type: 'text',
    body:
      '"Northpoint CAD" (also called "the CAD") means this Northpoint Roleplay Computer-Aided Dispatch and community website. It is operated by the Northpoint Roleplay leadership team for the Northpoint Roleplay Emergency Response: Liberty County (ER:LC) roleplay community.\n\nIt includes the public community site (announcements, gallery, departments, staff directory, events, store links, and news) and the signed-in CAD tools used by members and staff for roleplay records, department rosters, resources, and related community operations.',
  },
  { type: 'heading', text: '2. Roleplay only' },
  {
    type: 'text',
    body:
      'Northpoint CAD and Northpoint Roleplay are for entertainment and roleplay only. Nothing in this system represents a real government agency, law enforcement department, or official public service. Do not treat CAD records, callsigns, or department content as real-world legal or emergency information.',
  },
  { type: 'heading', text: '3. Who can use it' },
  {
    type: 'text',
    body:
      'Anyone may view public pages on the community site.\n\nSigned-in CAD access is limited to members of the Northpoint Roleplay Discord server who sign in with Discord. Some areas (staff tools, admin tools, department tools, and similar) require approved ranks or staff permissions. Leadership may grant, change, or revoke access at any time.',
  },
  { type: 'heading', text: '4. Your account' },
  {
    type: 'text',
    body:
      'You sign in with Discord OAuth. You must use your own Discord account and remain a member of the Northpoint Roleplay Discord server where required.\n\n• Keep your Discord account secure.\n• Do not share your session or attempt to use another person\'s account.\n• Use Northpoint CAD only for legitimate Northpoint Roleplay community and staff purposes.',
  },
  { type: 'heading', text: '5. Acceptable use' },
  {
    type: 'text',
    body:
      'You agree not to misuse Northpoint CAD. That includes, without limitation:\n\n• Attempting unauthorized access to staff, admin, or other users\' data\n• Scraping, abusing APIs, or disrupting the service\n• Uploading unlawful, harmful, or clearly abusive content\n• Using the CAD to harass others outside normal roleplay boundaries\n• Circumventing rank, department, or permission controls',
  },
  { type: 'heading', text: '6. Community content and records' },
  {
    type: 'text',
    body:
      'Content you create or submit in Northpoint CAD (for example civilian characters, vehicle records, reports, gallery uploads by authorized staff, announcements, or department resources) may be stored and reviewed by authorized staff and leadership for roleplay operations, moderation, and accountability.\n\nPublic pages may display community-facing content such as announcements, gallery images, events, staff listings, and store information.',
  },
  { type: 'heading', text: '7. Availability' },
  {
    type: 'text',
    body:
      'Northpoint CAD is provided free of charge for the Northpoint Roleplay community on an "as is" and "as available" basis. We do not guarantee uninterrupted, error-free, or permanent availability. Features may change as the community and systems evolve.',
  },
  { type: 'heading', text: '8. Third parties' },
  {
    type: 'text',
    body:
      'Northpoint CAD uses Discord for sign-in and community membership checks, and may display live information from ER:LC / related game or Discord integrations where configured. Optional third-party store links may also appear.\n\nNorthpoint Roleplay and Northpoint CAD are not affiliated with, endorsed by, or officially connected to Discord Inc., Roblox Corporation, Police Roleplay Community, or any real-world government or law enforcement agency.',
  },
  { type: 'heading', text: '9. Changes to these terms' },
  {
    type: 'text',
    body:
      'Leadership may update these Terms of Service from time to time. The current default or published version will be shown in Northpoint CAD. Continued use of Northpoint CAD after updates means you accept the revised terms.',
  },
  { type: 'heading', text: '10. Contact' },
  {
    type: 'text',
    body:
      'Questions about these terms should be raised with Northpoint Roleplay leadership through the official Northpoint Roleplay Discord server.',
  },
];

/** Built-in Privacy Policy shown until an admin publishes a custom version. */
export const DEFAULT_PRIVACY_SECTIONS: ContentBlock[] = [
  {
    type: 'text',
    body: 'Last updated: August 2026',
  },
  { type: 'heading', text: '1. Who we are' },
  {
    type: 'text',
    body:
      'This Privacy Policy explains how Northpoint CAD (the Northpoint Roleplay CAD & community website) handles information when you visit the public site or sign in to Northpoint CAD.\n\nNorthpoint CAD is operated by the Northpoint Roleplay community leadership for roleplay and community management. It is not a real government or commercial advertising platform.',
  },
  { type: 'heading', text: '2. Information we collect' },
  {
    type: 'text',
    body:
      'Depending on how you use Northpoint CAD, we may store:\n\n• Discord account details from sign-in — Discord ID, username, display name, avatar, and role information used for access control\n• Session information — a local session so you can stay signed in for a limited time\n• CAD / roleplay records you or staff create — such as civilian characters, vehicles, citations, arrests, and similar roleplay data\n• Staff and department data — roster membership, ranks, callsigns, resources, and related CAD content where applicable\n• Community content — announcements, gallery images, events, press items, store product cards, and similar public or staff-managed content\n• Basic technical logs needed to operate and secure the service (for example error or access logs)',
  },
  { type: 'heading', text: '3. What we do not do' },
  {
    type: 'text',
    body:
      'We do not sell your personal data to advertisers.\n\nWe do not use advertising trackers or ad cookies on Northpoint CAD.\n\nWe do not receive or store your Discord password — Discord handles authentication on Discord\'s own systems.',
  },
  { type: 'heading', text: '4. How we use information' },
  {
    type: 'text',
    body:
      'We use this information to:\n\n• Run the public Northpoint Roleplay community website and signed-in CAD tools\n• Confirm Discord membership and staff or department permissions\n• Support roleplay operations, rosters, resources, and moderation accountability\n• Publish community-facing updates (such as announcements, events, and gallery content) when authorized\n• Maintain and improve the reliability and security of Northpoint CAD',
  },
  { type: 'heading', text: '5. Where information is stored' },
  {
    type: 'text',
    body:
      'Northpoint CAD data is stored in the private database and hosting environment used for this project. Access is limited to the Northpoint CAD systems and authorized maintainers / leadership who need it to operate the community tools.',
  },
  { type: 'heading', text: '6. How long we keep it' },
  {
    type: 'text',
    body:
      'We keep information for as long as it is needed for community operations, roleplay continuity, moderation accountability, or technical maintenance.\n\nIf you leave the Northpoint Roleplay Discord community, you may contact leadership to ask about removing or limiting personal account-linked data where that is reasonably possible. Some roleplay or moderation history may be retained for accountability.',
  },
  { type: 'heading', text: '7. Your choices' },
  {
    type: 'text',
    body:
      'You can stop using signed-in features by signing out and not returning through Discord login.\n\nYou may ask Northpoint Roleplay leadership, via the official Discord server, to review or remove personal data associated with your Discord account where reasonable and practical.',
  },
  { type: 'heading', text: '8. Third parties' },
  {
    type: 'text',
    body:
      'Discord provides authentication and community membership. Live player or Discord stats, and optional store links, may rely on third-party services when configured.\n\nThose services have their own privacy policies. Northpoint CAD only uses them as needed to run the community site and CAD.',
  },
  { type: 'heading', text: '9. Changes to this policy' },
  {
    type: 'text',
    body:
      'We may update this Privacy Policy as Northpoint CAD features change. Meaningful updates will be reflected in Northpoint CAD and may also be announced in the Northpoint Roleplay Discord server.',
  },
  { type: 'heading', text: '10. Contact' },
  {
    type: 'text',
    body:
      'Privacy questions should be directed to Northpoint Roleplay leadership through the official Northpoint Roleplay Discord server.',
  },
];

export function resolveLegalSections(
  sections: ContentBlock[] | undefined | null,
  fallback: ContentBlock[],
): ContentBlock[] {
  return Array.isArray(sections) && sections.length > 0 ? sections : fallback;
}
