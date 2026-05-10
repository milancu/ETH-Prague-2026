import { z } from "zod"

export const MARKET_CATEGORIES = ["Politics", "Sport", "Czech", "Finance", "Weather"] as const

export const createMarketSchema = z
  .object({
    title: z.string().min(10, "At least 10 characters"),
    description: z.string().optional(),
    rules: z.string().optional(),
    category: z.enum(MARKET_CATEGORIES, { message: "Select a category" }),
    closingDate: z.string().min(1, "Required"),
    outcomeType: z.enum(["binary", "multi", "scalar"] as const),
    // multi — base allows empty; superRefine validates when outcomeType === "multi"
    outcomes: z.array(z.object({ label: z.string() })),
    // scalar
    scalarMin: z.coerce.number({ invalid_type_error: "Required" }).optional(),
    scalarMax: z.coerce.number({ invalid_type_error: "Required" }).optional(),
    scalarUnit: z.string().optional(),
    currentValue: z.coerce.number({ invalid_type_error: "Required" }).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.outcomeType === "multi") {
      if (d.outcomes.length < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least 3 outcomes required", path: ["outcomes"] })
      }
      d.outcomes.forEach((o, i) => {
        if (!o.label.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: ["outcomes", i, "label"] })
        }
      })
    }
    if (d.outcomeType === "scalar") {
      if (d.scalarMin === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: ["scalarMin"] })
      if (d.scalarMax === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: ["scalarMax"] })
      if (!d.scalarUnit?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: ["scalarUnit"] })
      if (d.currentValue === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: ["currentValue"] })
      if (d.scalarMin !== undefined && d.scalarMax !== undefined && d.scalarMax <= d.scalarMin) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be greater than min", path: ["scalarMax"] })
      }
      if (d.currentValue !== undefined && d.scalarMin !== undefined && d.scalarMax !== undefined) {
        if (d.currentValue < d.scalarMin || d.currentValue > d.scalarMax) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be between min and max", path: ["currentValue"] })
        }
      }
    }
  })

export type CreateMarketInput = z.infer<typeof createMarketSchema>