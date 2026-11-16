// Retired: spreadsheet edits are no longer an authority for order or payment state.
Deno.serve(() =>
  new Response(
    JSON.stringify({
      error: "Spreadsheet order-status synchronization is retired.",
    }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  )
);
