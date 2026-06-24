-- 채널별 프로필 사진 URL.
-- lead.profile_image_url은 대표 프로필 사진이고, channel_identities.profile_image_url은
-- Instagram/WhatsApp/Alibaba 등 채널별로 다를 수 있는 사진을 보존한다.

alter table public.channel_identities
  add column if not exists profile_image_url text;
