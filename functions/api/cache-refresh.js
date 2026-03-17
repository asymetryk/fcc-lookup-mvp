export async function onRequestPost() {
  return Response.json(
    {
      error:
        'Cache refresh is only supported in the local app right now. Refresh locally, commit the updated metadata file, then redeploy.',
    },
    { status: 501 },
  )
}
