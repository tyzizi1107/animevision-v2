"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ScrollRow } from "@/components/scroll-row";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: string;
  href?: string;
  children: ReactNode;
  className?: string;
};

export function SectionRow({ title, subtitle, href, children, className }: Props) {
  return (
    <section className={cn("group/row relative", className)}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white sm:text-[25px]">{title}</h2>
          {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-[#a79db7]">{subtitle}</p>}
        </div>
        {href && (
          <Link
            href={href}
            className="shrink-0 pb-1 text-[13px] font-medium text-[#cbb9e6] transition hover:text-white"
          >
            Tout voir&nbsp; →
          </Link>
        )}
      </div>

      <ScrollRow label={title} mobileGutter>{children}</ScrollRow>
    </section>
  );
}
