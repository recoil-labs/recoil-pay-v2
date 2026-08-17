import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { motion } from "framer-motion";

import { cn, springConfig } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

type DialogTriggerProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>,
  "render"
> & {
  asChild?: boolean;
  children?: React.ReactNode;
};

type DialogCloseProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>,
  "render"
> & {
  render?: React.ReactElement;
};

type DialogOverlayProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Backdrop>,
  "className" | "render"
> & {
  className?: string;
};

type DialogContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Popup>,
  "className" | "render"
> & {
  className?: string;
  showCloseButton?: boolean;
};

type DialogTitleProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>,
  "className"
> & {
  className?: string;
};

type DialogDescriptionProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>,
  "className"
> & {
  className?: string;
};

function Dialog({ children, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>;
}

function DialogTrigger({ children, asChild, ...props }: DialogTriggerProps) {
  if (asChild && React.isValidElement(children)) {
    return <DialogPrimitive.Trigger {...props} render={children} />;
  }

  return <DialogPrimitive.Trigger {...props}>{children}</DialogPrimitive.Trigger>;
}

function DialogPortal({ children, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal {...props}>{children}</DialogPrimitive.Portal>;
}

function DialogClose({ render, ...props }: DialogCloseProps) {
  return <DialogPrimitive.Close {...props} render={render} />;
}

function DialogOverlay({ className, ...props }: DialogOverlayProps) {
  return (
    <DialogPrimitive.Backdrop
      {...props}
      render={
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={springConfig}
          className={cn("fixed inset-0 z-50 bg-overlay backdrop-blur-md", className)}
        />
      }
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        {...props}
        render={
          <motion.div
            initial={{ opacity: 0, x: "-50%", y: "-48%", scale: 0.95 }}
            animate={{ opacity: 1, x: "-50%", y: "-50%", scale: 1 }}
            exit={{ opacity: 0, x: "-50%", y: "-48%", scale: 0.95 }}
            transition={springConfig}
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),32rem)] rounded-[24px] border border-border-subtle bg-surface-glass-strong p-5 font-sans text-sm text-app-text shadow-[0_34px_120px_-70px_var(--shadow-color),0_0_34px_var(--accent-cyan-soft)] backdrop-blur-2xl",
              className
            )}
          />
        }
      >
        {children}
        {showCloseButton && (
          <DialogClose
            render={
              <Button variant="ghost" className="absolute right-2 top-2 h-8 w-8 rounded-full" size="icon">
                <XIcon size={16} />
                <span className="sr-only">Close</span>
              </Button>
            }
          />
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({ className, children, showCloseButton = false, ...props }: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-[24px] border-t border-border-subtle bg-surface-input/70 p-5 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose render={<Button variant="outline">Close</Button>} />
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-display text-lg font-semibold text-app-text", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("font-sans text-sm leading-[1.6] text-text-secondary", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
