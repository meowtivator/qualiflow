# @qualiflow/adapter-alibaba

Alibaba inbound buyer adapter for QualiFlow.

This package does not scrape Alibaba. It defines the first integration boundary:

- normalize Alibaba buyer/inquiry data into QualiFlow `Lead`
- expose an Alibaba `ConversationAdapter` shape for imported or synced data
- build search candidates for sub-channel discovery such as Instagram, LinkedIn, and Facebook

Search candidates are intentionally links and query strings, not automatic web results. A later search provider can resolve those candidates into verified profiles.
