import { InMemoryUserRepository } from "../../user/user-repository-memory.js";
import { userRepositoryContract } from "./user-contract.js";

userRepositoryContract("InMemoryUserRepository", async () => ({
  repo: new InMemoryUserRepository(),
  teardown: async () => undefined,
}));
