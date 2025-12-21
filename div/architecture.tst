// /**
//  * ============================================================================
//  * ARCHITEKTUR: FEATURE-ORIENTIERT (Vertical Slices)
//  * ============================================================================
//  * Diese Struktur gruppiert Code nach fachlichen Features (z.B. User-Management).
//  * Jedes Feature enthält seine eigenen Routen, Controller, Services und Datenzugriffe.
//  */

// import express, { Request, Response, NextFunction } from 'express';
// import Database from 'better-sqlite3';

// // ============================================================================
// // DATEIPFAD: src/shared/infrastructure/database.ts
// // ============================================================================
// // Zentrale Datenbank-Instanz für die gesamte App.

// const db = new Database(':memory:');

// const initDb = () => {
//     db.prepare(`
//     CREATE TABLE IF NOT EXISTS users (
//       id INTEGER PRIMARY KEY AUTOINCREMENT,
//       username TEXT NOT NULL UNIQUE,
//       email TEXT NOT NULL UNIQUE,
//       password_hash TEXT NOT NULL,
//       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
//     )
//   `).run();
// };

// // ============================================================================
// // FEATURE: USERS (Ordner: src/features/users/)
// // ============================================================================

// /**
//  * DATEIPFAD: src/features/users/user.types.ts
//  * Definition der Datenmodelle (Entities) und Datentransferobjekte (DTOs).
//  */
// type UserEntity = {
//     id: number;
//     username: string;
//     email: string;
//     password_hash: string;
//     created_at: string;
// };

// type CreateUserDTO = {
//     username: string;
//     email: string;
//     passwordRaw: string;
// };

// type UserResponseDTO = {
//     id: number;
//     username: string;
//     email: string;
// };

// /**
//  * DATEIPFAD: src/features/users/user.mapper.ts
//  * Wandelt Datenbank-Entitäten in sichere API-Antworten um.
//  */
// const mapToResponse = (user: UserEntity): UserResponseDTO => ({
//     id: user.id,
//     username: user.username,
//     email: user.email,
// });

// /**
//  * DATEIPFAD: src/features/users/user.repository.ts
//  * Direkte Datenbank-Interaktion (SQL-Ebene).
//  */
// const userRepository = {
//     save(data: CreateUserDTO): UserEntity {
//         const hash = `hashed_${data.passwordRaw}`; // Hinweis: In Produktion bcrypt/argon2 nutzen!
//         const stmt = db.prepare(`
//       INSERT INTO users (username, email, password_hash)
//       VALUES (?, ?, ?)
//       RETURNING *
//     `);
//         return stmt.get(data.username, data.email, hash) as UserEntity;
//     },

//     findAll(): UserEntity[] {
//         return db.prepare('SELECT * FROM users').all() as UserEntity[];
//     }
// };

// /**
//  * DATEIPFAD: src/features/users/user.service.ts
//  * Geschäftslogik und Validierung.
//  */
// const userService = {
//     async registerUser(data: CreateUserDTO): Promise<UserResponseDTO> {
//         if (!data.email.includes('@')) throw new Error('Ungueltige E-Mail');

//         const entity = userRepository.save(data);
//         return mapToResponse(entity);
//     },

//     async listUsers(): Promise<UserResponseDTO[]> {
//         const entities = userRepository.findAll();
//         return entities.map(mapToResponse);
//     }
// };

// /**
//  * DATEIPFAD: src/features/users/user.controller.ts
//  * Request/Response Handling (Express-spezifisch).
//  */
// const userController = {
//     async register(req: Request, res: Response) {
//         try {
//             const result = await userService.registerUser(req.body);
//             res.status(201).json(result);
//         } catch (err: any) {
//             res.status(400).json({ error: err.message });
//         }
//     },

//     async list(req: Request, res: Response) {
//         try {
//             const users = await userService.listUsers();
//             res.json(users);
//         } catch (err: any) {
//             res.status(500).json({ error: 'Serverfehler' });
//         }
//     }
// };

// /**
//  * DATEIPFAD: src/features/users/user.routes.ts
//  * Routen-Definition fuer das Feature.
//  */
// const userRouter = express.Router();
// userRouter.post('/register', userController.register);
// userRouter.get('/', userController.list);

// // ============================================================================
// // DATEIPFAD: src/app.ts (Zusammenfuehrung)
// // ============================================================================

// const app = express();
// app.use(express.json());

// // Feature-Routing einbinden
// app.use('/api/users', userRouter);

// // ============================================================================
// // DATEIPFAD: src/server.ts (Einstiegspunkt)
// // ============================================================================

// const start = () => {
//     initDb();
//     const PORT = 3000;
//     app.listen(PORT, () => {
//         console.log(`Server laeuft auf http://localhost:${PORT}`);
//     });
// };

// start();