-- Breadcrumbs 0002: allow deleting adventures and photos.
-- RUN THIS in the Supabase SQL editor (or `supabase db push`) before using the delete features.

-- Owner can delete their adventure. Stops, members and photos rows go away via ON DELETE CASCADE
-- (cascades are not blocked by RLS).
create policy "owner can delete their adventure"
  on adventures for delete
  to authenticated
  using (owner_id = auth.uid());

-- Photo rows: the uploader can delete their own, the adventure owner can delete any.
create policy "uploader or adventure owner can delete photos"
  on photos for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from adventures a where a.id = adventure_id and a.owner_id = auth.uid())
  );

-- Storage objects in the private "photos" bucket (path: {adventure_id}/{stop_id}/{file}).
-- Adventure owner can delete anything in their adventure's folder;
-- an uploader can delete the file their own photos row points to.
-- NOTE: the app deletes the storage object BEFORE the photos row, so this lookup still finds the row.
create policy "owner or uploader can delete photos in storage"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and (
      exists (
        select 1 from public.adventures a
        where a.id::text = (storage.foldername(name))[1] and a.owner_id = auth.uid()
      )
      or exists (
        select 1 from public.photos p
        where p.storage_path = name and p.user_id = auth.uid()
      )
    )
  );
