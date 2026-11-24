-- A mosque timetable is shared reference data. Authenticated users may read
-- the prayer rows for their selected mosque; writes remain scoped to their own rows.
drop policy if exists "Users read selected mosque timetable" on public.prayer_times;
create policy "Users read selected mosque timetable" on public.prayer_times
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.user_preferences up
    where up.user_id = (select auth.uid())
      and up.preferred_mosque_id = prayer_times.mosque_id
  )
);
