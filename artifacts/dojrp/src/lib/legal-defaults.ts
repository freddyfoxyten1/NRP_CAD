import type { ContentBlock } from '@/components/shared/ContentBlocks';

/** Built-in Terms of Service shown until an admin publishes a custom version. */
export const DEFAULT_TERMS_SECTIONS: ContentBlock[] = [
  { type: 'heading', text: '1. What this is' },
  {
    type: 'text',
    body:
      '"The portal" means this DOJRP CAD & Roster site — a private staff and community tool used to manage Discord and Emergency Response: Liberty County (ERLC) game servers (shift tracking, rosters, moderation records, and related staff work).',
  },
  { type: 'heading', text: '2. Who can use it' },
  {
    type: 'text',
    body:
      'Access is limited to members of the DOJRP Discord community and approved staff. You must sign in with Discord and belong to the DOJRP Discord server. Some areas require a staff role.',
  },
  { type: 'heading', text: '3. Your account' },
  {
    type: 'text',
    body:
      'You sign in with Discord. Optional Roblox linking may be available in settings where enabled.\n\n• Use only your own Discord account.\n• Keep your Discord account secure.\n• Use the portal only for legitimate community and staff duties.',
  },
  { type: 'heading', text: '4. Acceptable use' },
  {
    type: 'text',
    body:
      'Do not misuse the portal, attempt unauthorized access, scrape data, abuse APIs, or disrupt the service for others.',
  },
  { type: 'heading', text: '5. Moderation records' },
  {
    type: 'text',
    body:
      'Actions taken through the portal (such as punishments and administrative commands) may be recorded for accountability and review by leadership.',
  },
  { type: 'heading', text: '6. Support tickets and the Helper Bot' },
  {
    type: 'text',
    body:
      'If you use Discord ticket applications or the Helper Bot, ticket content and transcripts may be stored and reviewed by staff for support and moderation. See our Privacy Policy for details.',
  },
  { type: 'heading', text: '7. Availability' },
  {
    type: 'text',
    body:
      'The portal is provided "as is" and free of charge. We do not guarantee uninterrupted or error-free service.',
  },
  { type: 'heading', text: '8. Third parties' },
  {
    type: 'text',
    body:
      'The portal connects to Discord and may use Roblox or ERLC-related APIs. We are not affiliated with Discord Inc., Roblox Corporation, or Police Roleplay Community.',
  },
  { type: 'heading', text: '9. Changes to these terms' },
  {
    type: 'text',
    body:
      'We may update these terms from time to time. Continued use of the portal after changes means you accept the updated terms.',
  },
  { type: 'heading', text: '10. Contact' },
  {
    type: 'text',
    body: 'Questions? Reach the leadership team through the DOJRP Discord server.',
  },
];

/** Built-in Privacy Policy shown until an admin publishes a custom version. */
export const DEFAULT_PRIVACY_SECTIONS: ContentBlock[] = [
  { type: 'bold_heading', text: 'Staff Portal' },
  { type: 'heading', text: '1. Who we are' },
  {
    type: 'text',
    body:
      'This CAD & Roster system is used by departments to publish and manage their policies, events, restrictions, and other departmental information.\n\nIt is also available for the wider community, allowing members to view public events, manage their businesses, and access other community resources.',
  },
  { type: 'heading', text: '2. What we collect' },
  {
    type: 'text',
    body:
      'When you sign in, we may store:\n\n• Discord account details — ID, username, display name, avatar, and roles.\n• Roblox account details — ID and username (if you link Roblox).\n• Shift / roster records — such as start and end times or department assignments.\n• Moderation records — punishments or actions issued through the portal.\n• A session cookie — to keep you signed in.',
  },
  { type: 'heading', text: '3. What we don\'t do' },
  {
    type: 'text',
    body:
      'We do not sell your data to advertisers, do not use tracking or analytics cookies for ads, and do not store your Discord password (sign-in happens on Discord\'s official site).',
  },
  { type: 'heading', text: '4. How we use it' },
  {
    type: 'text',
    body:
      'We use this information to run the portal, confirm guild and staff access, manage rosters and shifts, and connect your Discord identity to CAD records.',
  },
  { type: 'heading', text: '5. Where it\'s stored' },
  {
    type: 'text',
    body:
      'Data is stored in a private database used by this portal and accessible only to the portal and its maintainers.',
  },
  { type: 'heading', text: '6. How long we keep it' },
  {
    type: 'text',
    body:
      'Records are kept for staff and community accountability. Linked Roblox details stay until unlinked. Members who leave may ask leadership about data removal.',
  },
  { type: 'heading', text: '7. Your choices' },
  {
    type: 'text',
    body:
      'Linking Roblox (where available) is optional. You can ask the leadership team to see or delete your data where reasonable.',
  },
  { type: 'heading', text: '8. Third parties' },
  {
    type: 'text',
    body:
      'We use Discord\'s sign-in system and may use Roblox or ERLC game server APIs. Their own privacy policies apply to those services.',
  },
  { type: 'heading', text: '9. Changes to this policy' },
  {
    type: 'text',
    body: 'Meaningful changes will be announced in the DOJRP Discord server.',
  },
  { type: 'heading', text: '10. Contact' },
  {
    type: 'text',
    body: 'Questions? Contact the leadership team in the DOJRP Discord server.',
  },
  { type: 'divider' },
  { type: 'bold_heading', text: 'The Helper Bot / Ticketing System' },
  { type: 'heading', text: '1. What the Helper Bot does' },
  {
    type: 'text',
    body:
      'The Helper Bot / ticketing system helps members open support tickets in Discord and helps staff handle those tickets.',
  },
  { type: 'heading', text: '2. What we collect' },
  {
    type: 'text',
    body:
      'Ticket messages, attachments, usernames, Discord IDs, and transcripts may be stored so staff can review and resolve requests.',
  },
  { type: 'heading', text: '3. How we use it' },
  {
    type: 'text',
    body:
      'Ticket data is used only for support, moderation follow-up, and internal accountability — not for advertising.',
  },
  { type: 'heading', text: '4. Who can see it' },
  {
    type: 'text',
    body:
      'Authorized staff and leadership may review tickets and transcripts. Do not share sensitive personal information you would not want staff to see.',
  },
  { type: 'heading', text: '5. Retention' },
  {
    type: 'text',
    body:
      'Transcripts may be kept for a period needed for accountability and then removed or archived according to leadership policy.',
  },
  { type: 'heading', text: '6. Contact' },
  {
    type: 'text',
    body: 'Questions about tickets or the Helper Bot can be raised with leadership in Discord.',
  },
];

export function resolveLegalSections(
  sections: ContentBlock[] | undefined | null,
  fallback: ContentBlock[],
): ContentBlock[] {
  return Array.isArray(sections) && sections.length > 0 ? sections : fallback;
}
