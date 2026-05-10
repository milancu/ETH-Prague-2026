import type { SVGProps } from "react"

export function CzechFlagIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 60 40"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <rect width="60" height="20" fill="#FFFFFF" />
      <rect y="20" width="60" height="20" fill="#D7141A" />
      <polygon points="0,0 30,20 0,40" fill="#11457E" />
    </svg>
  )
}
