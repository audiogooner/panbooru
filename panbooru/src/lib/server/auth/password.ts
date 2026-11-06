import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 defaults to Argon2id.
const options = {
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1
};

export function hashPassword(password: string) {
	return hash(password, options);
}

export function verifyPassword(passwordHash: string, password: string) {
	return verify(passwordHash, password, options);
}
