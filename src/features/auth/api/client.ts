

type FetchConfig = {
    baserURL: string
    defaultHeaders: HeadersInit
}


type RequestOptions = RequestInit & {
    params?: Record<string, string>
}


const createConfig = (): FetchConfig => ({
    baserURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
    defaultHeaders: {
        'Content-Type': 'application/json'
    }
})

const buildURL = (baserURL: string, endpoint: string, params?: Record<string, string>): string => {
    const url = new URL(endpoint, baserURL)

    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.append(key, value)
        })
    }

    return url.toString();
}

const withAuthHeader = (token: string | null) =>
    (request: RequestInit): RequestInit => {
        if (!token) return request;

        return {
            ...request,
            headers: {
                ...request.headers,
                'Authorization': `Bearer ${token}`
            }
        }
    }

const fetchJSON = async<T>(
    endpoint: string,
    options: RequestOptions = {},
    config: FetchConfig
): Promise<T> => {
    const { params, ...fetOptions } = options
    const url = buildURL(config.baserURL, endpoint, params)

    const response = await fetch(url, {
        ...fetOptions,
        headers: {
            ...config.defaultHeaders,
            ...fetOptions.headers
        }
    })

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json()
}