import { z } from "zod";

export const createColorSchema = z.object({
  fabricId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().max(50).optional(),
  // Real visual color, e.g. "#000000" (or 3/4/8-digit hex). Optional &
  // independent from `code` (code is NOT a hex value).
  hex: z
    .string()
    .max(9)
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "hex غير صالح")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  imageUrl: z.string().max(2_000_000).optional(),
});

export const updateColorSchema = createColorSchema.partial().omit({ fabricId: true });

export const listColorsSchema = z.object({
  fabricId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(20),
});

export type CreateColorInput = z.infer<typeof createColorSchema>;
