import { createInstagramAdapterFromConversations } from "./index";

const adapter = createInstagramAdapterFromConversations(
  [
    {
      id: "ig-conversation-1",
      accountKind: "professional_account",
      profile: {
        id: "ig-user-1",
        username: "mirae_beauty_hk",
        displayName: "Mirae Beauty HK",
        companyName: "Mirae Beauty HK",
        countryCode: "HK",
        profileImageUrl: "https://example.com/mirae-profile.jpg"
      },
      messages: [
        {
          id: "m1",
          conversationId: "ig-conversation-1",
          text: "Can you send mask pack samples?",
          sentAt: "2026-05-22T04:30:00.000Z",
          outgoing: false,
          senderUsername: "mirae_beauty_hk"
        },
        {
          id: "m2",
          conversationId: "ig-conversation-1",
          text: "Yes, we can arrange sample options after confirming the target channel.",
          sentAt: "2026-05-22T05:10:00.000Z",
          outgoing: true
        }
      ]
    }
  ],
  { operatorDisplayName: "QualiFlow Operator" }
);

const result = await adapter.syncMessages?.();

if (!result || result.leads.length !== 1 || result.threads.length !== 1 || result.messages.length !== 2) {
  throw new Error("Instagram normalization check failed");
}

if (result.leads[0]?.profileImageUrl !== "https://example.com/mirae-profile.jpg") {
  throw new Error("Instagram profile image normalization failed");
}

console.log("Instagram normalization check passed");
