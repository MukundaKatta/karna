import React from 'react';
import { Redirect } from 'expo-router';

export default function IndexRoute() {
  return <Redirect href="/(tabs)/chat" />;
}
