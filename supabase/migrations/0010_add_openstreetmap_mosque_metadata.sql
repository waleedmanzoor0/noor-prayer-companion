-- Metadata for mosque discovery from OpenStreetMap.
-- User coordinates are never stored; only public mosque coordinates are stored.
alter table public.mosques
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists osm_key text unique,
  add column if not exists osm_source text;

create index if not exists mosques_location_idx
  on public.mosques(latitude, longitude)
  where latitude is not null and longitude is not null;

comment on column public.mosques.latitude is 'Public mosque latitude from its directory/map source';
comment on column public.mosques.longitude is 'Public mosque longitude from its directory/map source';
comment on column public.mosques.osm_key is 'OpenStreetMap element identifier, for example node/12345';
comment on column public.mosques.osm_source is 'Attribution/source for public mosque directory metadata';
