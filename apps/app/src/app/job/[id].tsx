import { router, useLocalSearchParams } from 'expo-router';
import { JobDetailView } from '@/components/JobDetail';
import { Button, Empty, Header, Loading, Screen } from '@/components/ui';
import { useJob } from '@/lib/hooks';

export default function JobPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useJob(id ?? null);
  return (
    <Screen
      header={<Header title={job.data?.role ?? 'Job'} subtitle={job.data ? undefined : ' '} />}
    >
      {job.isLoading ? (
        <Loading />
      ) : job.data ? (
        <JobDetailView
          job={job.data}
          onGone={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      ) : (
        <Empty
          icon="error-outline"
          title="Couldn’t load this job"
          body={(job.error as Error | null)?.message}
          action={<Button label="Back to Jobs" onPress={() => router.replace('/')} />}
        />
      )}
    </Screen>
  );
}
