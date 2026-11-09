"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, wasExplicitLogout } from "@/lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (getToken()) {
      router.replace("/dashboard");
      return;
    }
    if (wasExplicitLogout()) {
      router.replace("/login");
      return;
    }
    api.refresh().then((token) => router.replace(token ? "/dashboard" : "/login"));
  }, [router]);

  return null;
}
