insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "Customers can read their profile photo"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar');

create policy "Customers can add their profile photo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar');

create policy "Customers can replace their profile photo"
  on storage.objects for update to authenticated
  using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar')
  with check (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar');
