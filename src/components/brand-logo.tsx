import Image from "next/image";

const SIZES = {
  compact: { frame: "h-12 w-12", image: 112 },
  header: { frame: "h-14 w-14", image: 140 },
  large: { frame: "h-20 w-20", image: 176 },
} as const;

export function BrandLogo({
  size = "header",
  priority = false,
}: {
  size?: keyof typeof SIZES;
  priority?: boolean;
}) {
  const dimensions = SIZES[size];

  return (
    <span className={`relative block shrink-0 overflow-hidden ${dimensions.frame}`}>
      <Image
        src="/images/animevision.png"
        alt=""
        width={dimensions.image}
        height={dimensions.image}
        priority={priority}
        className="absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
        style={{ width: dimensions.image, height: dimensions.image }}
      />
    </span>
  );
}
