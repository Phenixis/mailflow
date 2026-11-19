export const PLUGIN_ID = 'jev-tags';
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_HOST = 'api.typesafe.ai';

// The tags created for a user who asks for the defaults, and the yes/no question Jev answers for each.
// `private` is the privacy gate: a message scoring above the private threshold is tagged, and its
// body is never sent. Which tag is the gate is a setting (privacyTagKey).
export const DEFAULT_TAGS = [
  {
    key: 'private',
    name: 'Private',
    color: '#8b5cf6',
    question: {
      instructions: 'The message contains or concerns personal or confidential information about the recipient or their relations (money, bills, health, insurance, identity, legal or administrative matters, private conversations between people). A generic automated notice with no personal data is not private.',
      true_what: 'Personal, financial, medical, legal, administrative or intimate information, or a one-to-one personal conversation',
      true_examples: ['Your account statement is available', 'Dentist invoice', 'Insurance', 'Your lab results', 'Your enrollment file', 'Re: tonight at my place'],
      false_what: 'Public, generic or purely technical content with no personal data',
      false_examples: ["This week's offers", 'New version available', 'November newsletter', 'Your SMTP keys will become inactive', 'Server container updates', 'Weekly usage report', 'Mailing-list announcement'],
    },
  },
  {
    key: 'important',
    name: 'Important',
    color: '#f59e0b',
    question: {
      instructions: 'The message deserves careful reading: it comes from a person or institution that matters to the recipient and calls for a reaction or contains useful information.',
      true_what: 'Message written to the recipient personally, or from an administration, university, employer, landlord, doctor or similar, or information worth keeping',
      true_examples: ['Exam summons', 'Your contract', 'Question from my thesis advisor', 'Your electricity bill is available'],
      false_what: 'Automated, promotional or inconsequential message',
      false_examples: ['20% off this weekend', 'Someone liked your post', 'Weekly usage report', 'Your order has shipped'],
    },
  },
  {
    key: 'urgent',
    name: 'Urgent',
    color: '#ef4444',
    question: {
      instructions: 'The recipient must act or reply within the next few days (or an event happens within the next few days), judged against current_date. Ignore pressure that is only marketing.',
      true_what: "A real, near deadline or imminent event that needs the recipient's attention",
      true_examples: ['Final reminder before disconnection', 'Reply needed before tomorrow', 'Your appointment is tomorrow at 6pm', 'Your API key will be disabled in 3 days'],
      false_what: 'No real deadline, or only artificial marketing urgency',
      false_examples: ['Sale ends Sunday', 'Last chance: 30% off', 'Your document is still waiting!', 'Monthly newsletter', 'Order confirmation', 'Receipt', 'Weekly report'],
    },
  },
];

export const DEFAULT_SETTINGS = {
  threshold_low: 0.35,
  threshold_high: 0.65,
  private_above: 0.4,
  max_body_chars: 500,
  model: 'jev-latest',
  privacyTagKey: 'private',
};
