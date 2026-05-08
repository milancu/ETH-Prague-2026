import * as axios from "axios"

const BE_API_URL = import.meta.env.VITE_API_URL

export const apiClient = axios.create({
  baseURL: BE_API_URL,
  withCredentials: true,
})
