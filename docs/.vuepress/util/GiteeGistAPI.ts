// GiteeGistAPI.ts
class GiteeGistAPI {
  private token: string;
  private baseURL: string = "https://gitee.com/api/v5";

  constructor(token: string) {
    this.token = token;
  }

  private async request(method: string, url: string, data: any = null) {
    const config: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    if (this.token) {
      config.headers["Authorization"] = `Bearer ${this.token}`;
    }

    if (data) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.baseURL}${url}`, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP error! status: ${response.status}`
        );
      }

      return await response.json();
    } catch (error) {
      console.error("API Request failed:", error);
      throw error;
    }
  }

  async createGist(
    description: string,
    files: Record<string, { content: string }>
  ) {
    return this.request("POST", "/gists", {
      description,
      public: false,
      files,
    });
  }

  async getGists(page: number = 1, per_page: number = 20) {
    const url = `/gists?page=${page}&per_page=${per_page}`;
    return this.request("GET", url);
  }

  async getGist(id: string) {
    return this.request("GET", `/gists/${id}`);
  }

  async updateGist(
    id: string,
    updates: {
      description?: string;
      files?: Record<string, { content: string }>;
    }
  ) {
    return this.request("PATCH", `/gists/${id}`, updates);
  }
}

export default GiteeGistAPI;
