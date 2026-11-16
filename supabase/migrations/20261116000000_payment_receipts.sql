-- Receipts contain customer details. Only service-role functions access this bucket.
-- Downloads authenticate the customer and check order ownership before reading it.
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, array['application/pdf'])
on conflict (id) do nothing;
