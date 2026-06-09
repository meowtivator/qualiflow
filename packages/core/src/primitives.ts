export type EntityId = string;

export type ISODateTime = string;

export type UrlString = string;

export type EmailAddress = string;

export type CountryCode = string;

export type MetadataValue = string | number | boolean | null | MetadataValue[] | { [key: string]: MetadataValue };

export type Metadata = Record<string, MetadataValue>;

export type PageCursor = string;

export type PageRequest = {
  cursor?: PageCursor;
  limit?: number;
};

export type Page<TItem> = {
  items: TItem[];
  nextCursor?: PageCursor;
};
