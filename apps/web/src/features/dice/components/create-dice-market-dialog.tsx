import React, { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Dices, Info, Sparkles } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/animate-ui/components/base/dialog"
import {
  diceCreateFormSchema,
  type DiceCreateFormInput,
} from "@/features/dice/lib/schema"
import { useCreateDiceMarket } from "@/features/dice/hooks/use-create-dice-market"

function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode
  htmlFor?: string
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase"
    >
      {children}
    </label>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-destructive text-[11px]">{message}</p>
}

interface Props {
  trigger?: React.ReactElement
}

export function CreateDiceMarketDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false)
  const { createDiceMarket, isPending } = useCreateDiceMarket()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DiceCreateFormInput>({
    resolver: zodResolver(diceCreateFormSchema),
    defaultValues: {
      title: "",
      description: "",
      delayMinutes: 5,
    },
  })

  const onSubmit = async (data: DiceCreateFormInput) => {
    try {
      await createDiceMarket(data)
      reset()
      setOpen(false)
    } catch {
      /* toast already surfaced in hook */
    }
  }

  const defaultTrigger = (
    <Button variant="outline" className="gap-1.5">
      <Dices className="size-4" aria-hidden />
      Cosmic Dice
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? defaultTrigger} />

      <DialogPopup className="sm:max-w-md" showCloseButton>
        <div className="flex flex-col gap-5 p-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-purple-400" aria-hidden />
              Cosmic Dice Market
            </DialogTitle>
            <DialogDescription>
              A 6-outcome market resolved by SpaceComputer's cosmic ray beacon.
              Nobody — not even you — can predict the result.
            </DialogDescription>
          </DialogHeader>

          <form
            id="create-dice-form"
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="dice-title">Market title</FieldLabel>
              <Input
                id="dice-title"
                placeholder="Cosmic Dice #1"
                aria-invalid={!!errors.title}
                {...register("title")}
              />
              <FieldError message={errors.title?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="dice-description">Description</FieldLabel>
              <Textarea
                id="dice-description"
                rows={3}
                placeholder="What's at stake on this dice roll?"
                {...register("description")}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="dice-delay">Delay (minutes)</FieldLabel>
              <Input
                id="dice-delay"
                type="number"
                min={1}
                max={120}
                step={1}
                aria-invalid={!!errors.delayMinutes}
                {...register("delayMinutes")}
              />
              <p className="text-muted-foreground text-[11px]">
                How far in the future the cosmic beacon block lands. Default 5.
              </p>
              <FieldError message={errors.delayMinutes?.message} />
            </div>

            <div
              className={cn(
                "border-border text-muted-foreground flex items-start gap-2 border p-3 text-[11px]",
              )}
            >
              <Info
                className="text-muted-foreground mt-px size-3.5 shrink-0"
                aria-hidden
              />
              <span>
                Two transactions will be requested — a{" "}
                <span className="text-foreground font-semibold">50 TAB</span>{" "}
                bond approval and the market creation itself.
              </span>
            </div>
          </form>
        </div>

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
            form="create-dice-form"
            disabled={isSubmitting || isPending}
          >
            {isSubmitting || isPending ? "Rolling…" : "Roll the cosmic dice"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
