"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/review", "Review"],
  ["/upload", "Upload"],
  ["/schedule", "Schedule"],
  ["/sets", "Account sets"],
  ["/settings", "Settings"],
];

export function NavLinks() {
  const path = usePathname();
  return (
    <>
      {links.map(([href, label]) => (
        <Link key={href} href={href} className={path.startsWith(href) ? "active" : ""}>
          {label}
        </Link>
      ))}
    </>
  );
}
