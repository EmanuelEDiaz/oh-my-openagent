import { loadConfig } from "./config"
import { HttpClient } from "./http/client"
import { UserService } from "./users/service"

const config = loadConfig()
const http = new HttpClient(config.upstreamUrl)
export const users = new UserService(http)
