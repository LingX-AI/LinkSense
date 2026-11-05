import systemUpdateArtwork from "@/assets/brand/system-update-artwork.webp"

export function SystemUpdateArtwork() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none flex aspect-[3/1] w-full shrink-0 items-center justify-center bg-muted select-none"
    >
      <img
        src={systemUpdateArtwork}
        alt=""
        width={2172}
        height={724}
        draggable={false}
        className="block h-full w-full min-w-0 object-contain"
      />
    </div>
  )
}
