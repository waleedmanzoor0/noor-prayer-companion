-- The user_preferences RLS policies already restrict each row to its owner.
-- Grant the authenticated role the table operations needed for the app UI.

grant select, insert, update on table public.user_preferences to authenticated;
