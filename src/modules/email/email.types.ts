export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Everything that can be emailed. Raw tokens only ever travel inside these jobs. */
export type EmailJob =
  | {
      type: "ORGANIZATION_INVITATION";
      to: string;
      organizationName: string;
      inviterName: string;
      role: string;
      token: string;
    }
  | {
      type: "CLIENT_PORTAL_INVITE";
      to: string;
      contactName: string;
      organizationName: string;
      token: string;
    }
  | {
      type: "NOTIFICATION";
      to: string;
      recipientName: string;
      title: string;
      message: string;
    };
