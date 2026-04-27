import type { SVGProps } from "react";

interface PulsarLogoProps extends Omit<SVGProps<SVGSVGElement>, "fill" | "stroke"> {
  /** Size and color classes. Color via text-* picks up dark: variants automatically. */
  className?: string;
  /**
   * Inline colour override. When set, fill and stroke are written directly into
   * the SVG attributes instead of inheriting via currentColor. Use for contexts
   * where Tailwind classes do not apply (e.g. email rendering, embedded SVGs).
   * Common values: "white", "black", "#ffffff", any CSS colour string.
   */
  color?: string;
}

/**
 * Pulsar beacon logo. Three concentric circles. Colour is normally controlled
 * via text-* utility classes (the SVG uses currentColor) but can be overridden
 * with the explicit `color` prop for fixed-colour contexts.
 *
 * Conventions:
 *   Theme-reactive: <PulsarLogo />  (uses default text-purple-700 dark:text-purple-400)
 *   On dark background: <PulsarLogo color="white" />
 *   On light background: <PulsarLogo color="black" />  (or text-gray-900)
 */
export default function PulsarLogo({
  className = "h-8 w-8 text-purple-700 dark:text-purple-400",
  color,
  ...rest
}: PulsarLogoProps) {
  const paint = color ?? "currentColor";
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...rest}
    >
      <circle cx="16" cy="16" r="5" fill={paint} />
      <circle cx="16" cy="16" r="9" stroke={paint} strokeWidth="1.5" opacity="0.6" />
      <circle cx="16" cy="16" r="13" stroke={paint} strokeWidth="1.5" opacity="0.3" />
    </svg>
  );
}
