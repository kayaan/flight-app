import { z } from 'zod'

export const UserSchema = z.object({
    id: z.number(),
    firstname: z.string(),
    lastname: z.string(),
    email: z.string(),
    role: z.enum(['user', 'admin'])
})

export const LoginResponseSchema = z.object({
    token: z.string(),
    user: UserSchema
})

export type LoginResponse = z.infer<typeof LoginResponseSchema>
