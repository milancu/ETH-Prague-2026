import React, { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/animate-ui/components/base/dialog";
import {
  type CreateMarketInput,
  createMarketSchema,
  MARKET_CATEGORIES,
} from "@/features/market/lib/schema";
import { useCreateMarket } from "@/features/market/hooks/use-create-market";
import { ScrollArea } from "@workspace/ui/components/scroll-area.tsx"

// ── Field helpers ────────────────────────────────────────────────────────────

function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase"
    >
      {children}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-destructive text-[11px]">{message}</p>;
}

function Field({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>
  );
}

// ── Outcome type toggle ──────────────────────────────────────────────────────

const OUTCOME_TYPES = [
  { value: "binary", label: "Binary", hint: "YES / NO" },
  { value: "multi", label: "Multi", hint: "Multiple choices" },
  { value: "scalar", label: "Scalar", hint: "Numeric range" },
] as const;

// ── Main dialog ──────────────────────────────────────────────────────────────

interface CreateMarketDialogProps {
  trigger?: React.ReactElement;
}

export function CreateMarketDialog({ trigger }: CreateMarketDialogProps) {
  const [open, setOpen] = useState(false);
  const { createMarket } = useCreateMarket();

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateMarketInput>({
    resolver: zodResolver(createMarketSchema),
    defaultValues: {
      category: undefined,
      outcomeType: "binary" as const,
      outcomes: [{ label: "" }, { label: "" }, { label: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "outcomes",
  });
  const outcomeType = watch("outcomeType");

  const onSubmit = async (data: CreateMarketInput) => {
    try {
      await createMarket(data);
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transaction failed", {
        id: "market-create",
      });
    }
  };

  const todayMin = new Date().toISOString().split("T")[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? <Button>Add Market</Button>} />

      <DialogPopup className="sm:max-w-xl" showCloseButton>
        {/* Scrollable area: header + form fields */}
        <ScrollArea className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle>Create Market</DialogTitle>
            <DialogDescription>
              Propose a new prediction market. After submission it will be
              reviewed by curators.
            </DialogDescription>
          </DialogHeader>

          <form
            id="create-market-form"
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-5"
          >
            {/* Title */}
            <Field>
              <FieldLabel htmlFor="title">Market question</FieldLabel>
              <Input
                id="title"
                placeholder="Will BTC exceed 100,000 USD before end of 2026?"
                aria-invalid={!!errors.title}
                {...register("title")}
              />
              <FieldError message={errors.title?.message} />
            </Field>

            {/* Description */}
            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea
                id="description"
                placeholder="Provide context about this market — what event does it track, what sources will be used to determine the outcome?"
                rows={3}
                {...register("description")}
              />
            </Field>

            {/* Rules */}
            <Field>
              <FieldLabel htmlFor="rules">Resolution rules</FieldLabel>
              <Textarea
                id="rules"
                placeholder="How will this market be resolved? Which source is authoritative? What happens in edge cases?"
                rows={3}
                {...register("rules")}
              />
            </Field>

            {/* Category + Closing date */}
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>Category</FieldLabel>
                <Controller
                  control={control}
                  name="category"
                  render={({ field }) => (
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <SelectTrigger
                        className="w-full"
                        aria-invalid={!!errors.category}
                      >
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {MARKET_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {cat}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError message={errors.category?.message} />
              </Field>

              <Field>
                <FieldLabel htmlFor="closingDate">Closes on</FieldLabel>
                <Input
                  id="closingDate"
                  type="date"
                  min={todayMin}
                  aria-invalid={!!errors.closingDate}
                  {...register("closingDate")}
                />
                <FieldError message={errors.closingDate?.message} />
              </Field>
            </div>

            {/* Outcome type */}
            <Field>
              <FieldLabel>Outcome type</FieldLabel>
              <Controller
                control={control}
                name="outcomeType"
                render={({ field }) => (
                  <div
                    className="flex gap-2"
                    role="group"
                    aria-label="Outcome type"
                  >
                    {OUTCOME_TYPES.map(({ value, label, hint }) => {
                      const active = field.value === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => field.onChange(value)}
                          className={cn(
                            "flex flex-1 flex-col items-start px-3 py-2.5",
                            "transition-[background-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                            "active:scale-[0.97]",
                            active
                              ? "bg-primary/10 ring-primary/40 ring-1"
                              : "bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/60",
                          )}
                        >
                          <span className="text-foreground text-xs font-semibold">
                            {label}
                          </span>
                          <span className="text-muted-foreground text-[10px]">
                            {hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              />
            </Field>

            {/* Multi outcomes */}
            {outcomeType === "multi" && (
              <Field>
                <FieldLabel>Outcomes</FieldLabel>
                <div className="flex flex-col gap-2">
                  {fields.map((field, i) => (
                    <div key={field.id} className="flex items-center gap-2">
                      <Input
                        placeholder={`Outcome ${i + 1}`}
                        aria-label={`Outcome ${i + 1}`}
                        aria-invalid={!!errors.outcomes?.[i]?.label}
                        {...register(`outcomes.${i}.label`)}
                      />
                      {fields.length > 2 && (
                        <button
                          type="button"
                          aria-label="Remove outcome"
                          onClick={() => remove(i)}
                          className="text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-destructive shrink-0 p-1 transition-colors duration-150"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                  {(errors.outcomes as { message?: string } | undefined)
                    ?.message && (
                    <FieldError
                      message={
                        (errors.outcomes as { message?: string }).message
                      }
                    />
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ label: "" })}
                    className="self-start"
                  >
                    <Plus data-icon="inline-start" aria-hidden="true" />
                    Add outcome
                  </Button>
                </div>
              </Field>
            )}

            {/* Scalar fields */}
            {outcomeType === "scalar" && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <Field>
                    <FieldLabel htmlFor="scalarMin">Min</FieldLabel>
                    <Input
                      id="scalarMin"
                      type="number"
                      placeholder="0"
                      aria-invalid={!!errors.scalarMin}
                      {...register("scalarMin")}
                    />
                    <FieldError message={errors.scalarMin?.message} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="scalarMax">Max</FieldLabel>
                    <Input
                      id="scalarMax"
                      type="number"
                      placeholder="100"
                      aria-invalid={!!errors.scalarMax}
                      {...register("scalarMax")}
                    />
                    <FieldError message={errors.scalarMax?.message} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="scalarUnit">Unit</FieldLabel>
                    <Input
                      id="scalarUnit"
                      placeholder="USD"
                      aria-invalid={!!errors.scalarUnit}
                      {...register("scalarUnit")}
                    />
                    <FieldError message={errors.scalarUnit?.message} />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="currentValue">
                    Initial consensus value
                  </FieldLabel>
                  <Input
                    id="currentValue"
                    type="number"
                    placeholder="50"
                    aria-invalid={!!errors.currentValue}
                    {...register("currentValue")}
                  />
                  <FieldError message={errors.currentValue?.message} />
                </Field>
              </div>
            )}

            {/* Bond info */}
            <div className="border-border text-muted-foreground flex items-start gap-2 border p-3 text-[11px]">
              <Info
                className="text-muted-foreground mt-px size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                Creating a market requires a{" "}
                <span className="text-foreground font-semibold">
                  50 TAB bond
                </span>{" "}
                deposited as anti-spam collateral. It is returned when the
                market resolves.
              </span>
            </div>
          </form>
        </ScrollArea>

        {/* Sticky footer — always at bottom, content above scrolls */}
        <DialogFooter className="border-border shrink-0 border-t p-4">
          <DialogClose
            render={
              <Button type="button" variant="outline">
                Cancel
              </Button>
            }
          />
          <Button
            type="submit"
            form="create-market-form"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating…" : "Create Market"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
