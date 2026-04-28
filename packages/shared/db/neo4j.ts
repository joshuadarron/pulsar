import neo4j, { type Driver, type Session } from 'neo4j-driver';
import { env } from '../config/env';

let driver: Driver;

export function getDriver(): Driver {
	if (!driver) {
		driver = neo4j.driver(env.neo4j.uri, neo4j.auth.basic(env.neo4j.username, env.neo4j.password));
	}
	return driver;
}

export function getSession(): Session {
	return getDriver().session();
}

export async function closeDriver(): Promise<void> {
	if (driver) await driver.close();
}
