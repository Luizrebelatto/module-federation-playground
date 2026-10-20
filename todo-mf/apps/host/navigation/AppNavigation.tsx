import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeScreen } from '../screens/HomeScreen';
import { LocalTodoRoute } from '../screens/LocalTodoRoute';
import { TodoScreen } from '../screens/TodoScreen';

export type RootStackParamList = {
  Home: undefined;
  Todo: undefined;
  LocalTodo: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigation() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Host' }} />
        <Stack.Screen name="Todo" component={TodoScreen} options={{ title: 'Todo' }} />
        <Stack.Screen name="LocalTodo" component={LocalTodoRoute} options={{ title: 'Todo local' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}