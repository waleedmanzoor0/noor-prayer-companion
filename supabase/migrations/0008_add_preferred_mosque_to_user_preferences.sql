alter table public.user_preferences
  add column if not exists preferred_mosque_id uuid
  references public.mosques(id) on delete set null;

update public.user_preferences up
set preferred_mosque_id = (
  select pt.mosque_id
  from public.prayer_times pt
  where pt.user_id = up.user_id
    and pt.mosque_id is not null
  order by pt.prayer_date desc
  limit 1
)
where up.preferred_mosque_id is null
  and exists (
    select 1 from public.prayer_times pt
    where pt.user_id = up.user_id and pt.mosque_id is not null
  );